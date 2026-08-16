-- 20260816000000_cdb_receipt_identity_is_cross_path.sql
--
-- ═══ O QUE ACONTECEU (2026-08-16) ════════════════════════════════════════════════════════════
--
-- `receipt_catchup_20260816.py` mandou comprovante para Bossle e Rodrigo Hajj, que ja tinham
-- recebido o recibo da MESMA versao gravada por outro caminho. O post-mortem do dia culpou o
-- filtro de dia (que de fato tinha sido removido e foi reposto), mas o filtro de dia nunca foi o
-- controle de duplicata -- era so o recorte da populacao. O controle de duplicata era este,
-- no cabecalho do proprio script:
--
--     "reserve_delivery usa UNIQUE(app, business_key, recipient_hash, generation); a chave
--      carrega a versao gravada. Rodar duas vezes da JA_ENTREGUE na segunda."
--
-- Verdadeiro, e insuficiente. A chave era:
--
--     producao        cdb2026:entry-saved-confirmation:<versao>:v1
--     catch-up 12/08  cdb2026:entry-saved-confirmation-catchup-20260812:<entrada>:<versao>:v1
--     catch-up 16/08  cdb2026:entry-saved-confirmation-catchup-20260816:<entrada>:<versao>:v1
--     teste de template cdb2026:entry-saved-confirmation-template-test:<versao>:v3
--
-- Quatro chaves diferentes para UM fato de negocio: "esta entrada ja tem recibo desta versao
-- gravada". A unicidade protegia cada CAMINHO contra si mesmo e nao protegia o participante
-- contra a soma deles. Nome de transporte virou identidade semantica, que e exatamente o que
-- nao pode acontecer.
--
-- ═══ A IDENTIDADE CANONICA ═══════════════════════════════════════════════════════════════════
--
--     ENTRADA + VERSAO GRAVADA DOS PALPITES     (independente de transporte)
--
-- Duas camadas, deliberadamente redundantes:
--
--   1. A CHAVE CANONICA. Todo remetente automatico de comprovante passa a reservar com
--      `cdb2026:entry-saved-confirmation:<versao>:v1` -- a chave de PRODUCAO -- porque um
--      catch-up nao e outro evento de negocio, e o mesmo recibo entregue por outro transporte.
--      Com isso NORMAL->CATCHUP e CATCHUP->NORMAL colidem no UNIQUE do banco, sem depender de
--      nenhum codigo Python concordar consigo mesmo.
--
--   2. `cdb_has_accepted_receipt(entrada, versao)`. Alcanca o que a camada 1 nao alcanca: as
--      familias historicas que ja gravaram com chave propria (teste de template aceito como
--      recibo real, os dois catch-ups one-off) e a entrega LEGADA pelo navegador, que nunca
--      passou por `notification_deliveries`.
--
-- A camada 1 sozinha deixaria TEMPLATE->CATCHUP passar. A camada 2 sozinha teria janela de
-- corrida entre a consulta e a reserva. Juntas nao tem furo nem janela.
--
-- ═══ O QUE CONTA COMO "JA RECEBEU" ═══════════════════════════════════════════════════════════
--
--   accepted   o provedor confirmou. Recebeu.
--   uncertain  o provedor foi chamado e a resposta se perdeu. Pode ter recebido -> FALHA FECHADA.
--   claimed    reserva concedida e nunca liquidada; o processo pode ter morrido DEPOIS da chamada.
--              Tambem falha fechada.
--
-- Um automatico so reenvia quando nao existe nenhum registro. "Talvez tenha recebido" nunca
-- autoriza um segundo e-mail -- foi assim que este incidente comecou.
--
-- ═══ NENHUM ENDERECO SAI DAQUI ═══════════════════════════════════════════════════════════════
--
-- A funcao resolve o e-mail internamente so para calcular o `recipient_hash` e nunca o devolve.
-- Devolve booleanos e nomes de familia. Mesma postura de `cdb_confirmation_recipient`: o portao
-- e o banco, nao a disciplina do chamador.
--
-- ROLLBACK: ver 20260816000000_cdb_receipt_identity_is_cross_path.rollback.sql. Esta migracao so
-- CRIA (duas tabelas, tres funcoes); nada existente e alterado.

-- ── REGISTRO DAS FAMILIAS QUE SAO O MESMO FATO DE NEGOCIO ───────────────────────────────────
--
-- Tabela e nao lista embutida na funcao: uma familia nova (um catch-up futuro, um remetente
-- manual) precisa ser DECLARADA para entrar na deduplicacao, e a declaracao fica visivel numa
-- linha em vez de escondida num `in (...)` dentro do corpo de uma funcao. Familia nao declarada
-- simplesmente nao dedupe -- e o lado seguro e ruidoso do erro.
create table if not exists bolao.cdb_receipt_family_registry (
  family      text        not null primary key,
  kind        text        not null,
  note        text        not null,
  declared_at timestamptz not null default now(),
  constraint cdb_receipt_family_kind_valido
    check (kind in ('automated', 'operator_manual', 'legacy'))
);

alter table bolao.cdb_receipt_family_registry enable row level security;
alter table bolao.cdb_receipt_family_registry force row level security;
revoke all on table bolao.cdb_receipt_family_registry from public;

comment on table bolao.cdb_receipt_family_registry is
  'Familias de entrega que representam O MESMO fato de negocio: "esta entrada ja tem recibo da '
  'versao X". Transporte diferente nao e evento diferente -- foi confundir os dois que mandou '
  'comprovante duplicado para duas pessoas em 2026-08-16.';

insert into bolao.cdb_receipt_family_registry (family, kind, note) values
  ('cdb2026:entry-saved-confirmation',
   'automated',
   'Caminho de producao: outbox -> send_entry_saved_confirmation.py. Chave canonica.'),
  ('cdb2026:entry-saved-confirmation-catchup',
   'automated',
   'Rotulo de auditoria da ferramenta generica de catch-up. Ela NAO reserva nesta familia: '
   'reserva na chave e na familia CANONICAS, porque um catch-up e o mesmo recibo por outro '
   'transporte. Declarada aqui para que qualquer linha historica rotulada assim tambem dedupe.'),
  ('cdb2026:entry-saved-confirmation-catchup-20260812',
   'automated',
   'One-off arquivado. Chave propria (entrada+versao) -- historico, reconhecido para dedupe.'),
  ('cdb2026:entry-saved-confirmation-catchup-20260816',
   'automated',
   'One-off arquivado, o do incidente. Chave propria (entrada+versao) -- historico.'),
  ('cdb2026:entry-saved-confirmation-template-test',
   'operator_manual',
   'Teste de template que o operador ACEITOU como comprovante real da versao dele. Conta como '
   'recibo entregue: o participante recebeu o documento, o nome do canal nao muda isso.'),
  ('cdb2026:entry-saved-confirmation-legacy-attested',
   'legacy',
   'Entrega pelo caminho antigo do navegador (queueReceipt/EmailJS), que nunca escreveu em '
   'notification_deliveries. So entra aqui por atestacao com evidencia -- ver '
   'cdb_attest_legacy_receipt.')
on conflict (family) do nothing;


-- ── ENTREGA LEGADA: PROVADA OU INCERTA, NUNCA CHUTADA ───────────────────────────────────────
--
-- O caminho antigo (navegador -> EmailJS) nao deixou registro de entrega nenhum. Existem duas
-- situacoes e elas NAO podem ser tratadas iguais:
--
--   PROVEN     da para amarrar o e-mail antigo a uma versao exata (o corpo trazia o codigo do
--              comprovante, ou o horario casa com um unico save). Vira recibo reconhecido.
--   UNCERTAIN  sabe-se que a pessoa recebeu ALGUM comprovante, nao qual versao. Nao da para
--              inventar o hash. Bloqueia o automatico e exige revisao do operador.
--
-- `picks_version` e NULL em UNCERTAIN de proposito: fabricar um hash plausivel para preencher a
-- coluna seria transformar "nao sei" em "sei", que e o defeito de raciocinio deste incidente
-- inteiro.
create table if not exists bolao.cdb_legacy_receipt_attestation (
  attestation_id uuid        not null default gen_random_uuid(),
  entry_id       text        not null,
  picks_version  text,
  certainty      text        not null,
  evidence       text        not null,
  recorded_at    timestamptz not null default now(),
  constraint cdb_legacy_receipt_attestation_pkey primary key (attestation_id),
  constraint cdb_legacy_certeza_valida
    check (certainty in ('PROVEN', 'UNCERTAIN')),
  -- PROVEN exige versao; UNCERTAIN exige a AUSENCIA dela. O banco recusa "provado, mas nao sei
  -- de que versao" e recusa "incerto, mas com hash preenchido".
  constraint cdb_legacy_versao_coerente_com_certeza
    check ((certainty = 'PROVEN' and picks_version is not null)
        or (certainty = 'UNCERTAIN' and picks_version is null))
);

alter table bolao.cdb_legacy_receipt_attestation enable row level security;
alter table bolao.cdb_legacy_receipt_attestation force row level security;
revoke all on table bolao.cdb_legacy_receipt_attestation from public;

create unique index if not exists cdb_legacy_receipt_proven_idx
  on bolao.cdb_legacy_receipt_attestation (entry_id, picks_version)
  where certainty = 'PROVEN';

comment on table bolao.cdb_legacy_receipt_attestation is
  'Entregas do caminho antigo do navegador, que nunca passaram por notification_deliveries. '
  'PROVEN carrega a versao exata e conta como recibo; UNCERTAIN nao carrega versao nenhuma e '
  'faz o automatico FALHAR FECHADO ate um operador revisar.';


-- ── A PERGUNTA CANONICA ─────────────────────────────────────────────────────────────────────
--
-- Uma pergunta, uma resposta, todos os caminhos. Todo remetente automatico chama ISTO antes de
-- considerar alguem elegivel -- e nao a data do save, nao a presenca de `lastClientRef`, nao o
-- historico de uma familia so.
create or replace function public.cdb_has_accepted_receipt(
  p_entry_id      text,
  p_picks_version text
)
  returns table (accepted boolean, uncertain boolean, paths text[], reason text)
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_email  text;
  v_hash   text;
  v_paths  text[] := array[]::text[];
  v_acc    boolean := false;
  v_unc    boolean := false;
  r        record;
begin
  -- Sem versao nao ha pergunta que faca sentido. Responder "nao recebeu" aqui autorizaria um
  -- envio baseado em nada.
  if p_picks_version is null or length(trim(p_picks_version)) = 0 then
    return query select false, true, v_paths, 'VERSAO_AUSENTE: falha fechada'::text;
    return;
  end if;

  -- O endereco e lido para virar hash e NUNCA sai desta funcao.
  select e->>'participantEmail' into v_email
    from bolao_state s,
         jsonb_array_elements(coalesce(s.state->'entries', '[]'::jsonb)) as e
   where s.id = 'cdb2026'
     and e->>'id' = p_entry_id
     and not coalesce(s.state->'deletedIds', '[]'::jsonb) ? p_entry_id
   limit 1;

  if v_email is null or length(trim(v_email)) = 0 then
    -- Sem endereco resolvivel nao da para saber o que ja foi entregue a esta pessoa. Falha
    -- fechada: o chamador nao envia.
    return query select false, true, v_paths,
                 'DESTINATARIO_NAO_RESOLVIVEL: falha fechada'::text;
    return;
  end if;

  v_hash := encode(sha256(convert_to(lower(trim(v_email)), 'utf8')), 'hex');

  -- ── Camada 1+2: qualquer familia DECLARADA cuja chave carregue esta versao ────────────────
  --
  -- A versao aparece sempre delimitada por ':' em todas as familias registradas -- producao
  -- (`...:<versao>:v1`), catch-ups (`...:<entrada>:<versao>:v1`) e teste de template
  -- (`...:<versao>:v3`). Casar com os dois-pontos dos dois lados evita colisao com prefixo.
  for r in
    select coalesce(d.family, d.business_key) as fam, d.status
      from bolao.notification_deliveries d
      join bolao.cdb_receipt_family_registry g
        on g.family = coalesce(d.family, d.business_key)
     where d.app = 'cdb2026'
       and d.recipient_hash = v_hash
       and d.business_key like '%:' || p_picks_version || ':%'
  loop
    if r.status = 'accepted' then
      v_acc := true;
      v_paths := v_paths || (r.fam || '#accepted');
    elsif r.status in ('claimed', 'uncertain') then
      -- O provedor pode ter sido chamado. Nao autoriza segundo envio.
      v_unc := true;
      v_paths := v_paths || (r.fam || '#' || r.status);
    end if;
  end loop;

  -- ── Camada 3: entrega legada atestada ────────────────────────────────────────────────────
  if exists (select 1 from bolao.cdb_legacy_receipt_attestation a
              where a.entry_id = p_entry_id
                and a.certainty = 'PROVEN'
                and a.picks_version = p_picks_version) then
    v_acc := true;
    -- `array_append`, e nao `||` com literal solto.
    --
    -- `text[] || 'algum texto'` e AMBIGUO: o literal nao tem tipo, o Postgres resolve para
    -- `anyarray || anyarray` e tenta ler a string como literal de array -- `malformed array
    -- literal` em tempo de EXECUCAO, so neste ramo. Nas duas linhas acima nao acontece porque
    -- `(r.fam || '#accepted')` ja e `text` por causa de `r.fam`.
    --
    -- A migracao compilava, a conferencia estrutural do teste passava (a palavra estava la), e a
    -- funcao quebrava na primeira atestacao legada registrada -- que e justamente o que o §4 do
    -- incidente manda o operador registrar. Achado rodando o corpo PL/pgSQL de verdade, num
    -- Postgres descartavel, na auditoria de 2026-08-16.
    v_paths := array_append(v_paths, 'cdb2026:entry-saved-confirmation-legacy-attested#accepted');
  end if;

  if exists (select 1 from bolao.cdb_legacy_receipt_attestation a
              where a.entry_id = p_entry_id
                and a.certainty = 'UNCERTAIN') then
    -- Nao da para provar de que versao era. Nao chutar: bloquear o automatico e mandar para
    -- revisao humana.
    v_unc := true;
    v_paths := array_append(v_paths, 'cdb2026:entry-saved-confirmation-legacy-attested#uncertain');
  end if;

  return query select v_acc, v_unc, v_paths,
    case
      when v_acc then 'RECIBO_ACEITO_EM_OUTRO_CAMINHO'
      when v_unc then 'INCERTO: exige revisao do operador'
      else 'SEM_RECIBO_DESTA_VERSAO'
    end::text;
end;
$$;

revoke all on function public.cdb_has_accepted_receipt(text, text) from public;
revoke all on function public.cdb_has_accepted_receipt(text, text) from anon;
revoke all on function public.cdb_has_accepted_receipt(text, text) from authenticated;
grant execute on function public.cdb_has_accepted_receipt(text, text) to service_role;


-- ── ATESTAR UMA ENTREGA LEGADA ──────────────────────────────────────────────────────────────
--
-- Verbo com nome proprio, porque afirmar "esta pessoa ja recebeu o recibo da versao X" suprime
-- um envio futuro legitimo. Exige evidencia em texto -- que fica gravada e legivel.
create or replace function public.cdb_attest_legacy_receipt(
  p_entry_id      text,
  p_picks_version text,
  p_certainty     text,
  p_evidence      text
)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
begin
  if p_evidence is null or length(trim(p_evidence)) < 12 then
    raise exception 'EVIDENCIA_OBRIGATORIA: atestacao sem evidencia legivel e chute';
  end if;
  if p_certainty = 'PROVEN' and (p_picks_version is null or length(trim(p_picks_version)) = 0) then
    raise exception 'PROVEN_EXIGE_VERSAO: nao fabricar hash historico';
  end if;
  if p_certainty = 'UNCERTAIN' and p_picks_version is not null then
    raise exception 'UNCERTAIN_NAO_CARREGA_VERSAO: "nao sei" nao vira "sei"';
  end if;

  insert into bolao.cdb_legacy_receipt_attestation (entry_id, picks_version, certainty, evidence)
  values (p_entry_id, nullif(trim(coalesce(p_picks_version, '')), ''), p_certainty, p_evidence)
  on conflict do nothing;
  return p_certainty;
end;
$$;

revoke all on function public.cdb_attest_legacy_receipt(text, text, text, text) from public;
revoke all on function public.cdb_attest_legacy_receipt(text, text, text, text) from anon;
revoke all on function public.cdb_attest_legacy_receipt(text, text, text, text) from authenticated;
grant execute on function public.cdb_attest_legacy_receipt(text, text, text, text) to service_role;


-- Leitura de conferencia: nomes de familia declarados, sem PII e sem contagem por pessoa.
create or replace function public.cdb_receipt_families()
  returns table (family text, kind text, note text)
  language sql
  stable
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
  select g.family, g.kind, g.note
    from bolao.cdb_receipt_family_registry g
   order by g.family;
$$;

revoke all on function public.cdb_receipt_families() from public;
revoke all on function public.cdb_receipt_families() from anon;
revoke all on function public.cdb_receipt_families() from authenticated;
grant execute on function public.cdb_receipt_families() to service_role;

select 'identidade do comprovante: entrada + versao, independente de transporte' as resultado;
