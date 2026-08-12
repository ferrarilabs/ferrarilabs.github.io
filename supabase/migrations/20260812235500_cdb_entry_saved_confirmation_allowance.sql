--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812230000_cdb_entry_saved_confirmation_allowance.sql
--
-- ═══ DUAS COISAS, E A PRIMEIRA E UMA REGRESSAO MINHA ═════════════════════════════════════════
--
-- 1. O comprovante de "entrada salva" JA EXISTE no navegador (`queueReceipt()` -> EmailJS). Mas
--    o caminho SEGURO que eu criei em 2026-08-12 (`if (_accessToken) { ... return r; }`) retorna
--    ANTES de chegar nele. Como os doze participantes entram por link personalizado, TODOS
--    passam pelo caminho seguro -- ou seja, ninguem recebe comprovante desde entao.
--
-- 2. O disjuntor `EMAIL_KILL_SWITCH` protege o sender PYTHON (convite/correcao). O comprovante
--    sai do NAVEGADOR e nunca passou por ele. Religar o comprovante sem uma trava propria
--    mandaria e-mail para quem salvasse -- possivelmente os doze.
--
-- ═══ O QUE ESTA FUNCAO E ═════════════════════════════════════════════════════════════════════
--
-- A permissao de UM comprovante, para UMA entrada, decidida NO SERVIDOR.
--
-- O navegador nao escolhe destinatario e nao decide se pode: ele apresenta o TOKEN, e o servidor
-- responde se aquela entrada especifica tem permissao e ainda nao gastou. Um participante que
-- edite o JavaScript nao consegue mais que isso -- nao ha parametro de destinatario para forjar.
--
-- "Exatamente uma vez" e a UNIQUE de `bolao.notification_deliveries`
-- (app, business_key, recipient_hash, generation), a mesma que ja protege o resto da plataforma.
-- Nao e um contador em memoria, nao e uma flag no cliente: e restricao de banco. Recarregar a
-- pagina, reabrir o link, salvar de novo ou reexecutar workflow colidem todos na mesma chave.
--
-- ═══ POR QUE UMA TABELA DE PERMISSAO, E NAO UM ID FIXO NO CORPO ══════════════════════════════
--
-- Permissao temporaria tem de ser REMOVIVEL sem migracao nova. A linha sai com um DELETE quando
-- o teste acabar; a funcao continua no lugar, permanentemente inofensiva, porque sem linha ela
-- nega tudo. Um id soldado no corpo exigiria outra migracao so para desligar -- e "desligar
-- depois" que depende de lembrar e o que produziu a tempestade de e-mail de hoje.

create table if not exists bolao.cdb_confirmation_allowance (
  entry_id   text primary key,
  note       text,
  created_at timestamptz not null default now()
);

comment on table bolao.cdb_confirmation_allowance is
  'Permissao NOMINAL de comprovante de entrada salva. Sem linha aqui, nenhum comprovante sai. '
  'Existe para que a autorizacao seja um DADO removivel, nao codigo -- desligar e um DELETE.';

alter table bolao.cdb_confirmation_allowance enable row level security;
alter table bolao.cdb_confirmation_allowance force row level security;
revoke all on table bolao.cdb_confirmation_allowance from public;

-- ── A RESERVA ────────────────────────────────────────────────────────────────────────────────
--
-- Devolve `allowed` uma unica vez por entrada. Nao levanta excecao quando nega: o navegador
-- precisa distinguir "nao mande" de "algo quebrou", e negar e um resultado NORMAL.
create or replace function public.cdb_reserve_entry_saved_email(p_token text)
  returns table (allowed boolean, reason text)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_entry_id text;
  v_hash     text;
  v_id       uuid;
begin
  v_entry_id := public._cdb_entry_id_from_token(p_token);
  if v_entry_id is null then
    -- Falha generica, igual ao resto do caminho seguro: nao diz se o token e invalido,
    -- revogado, ou de uma entrada removida.
    return query select false, 'ACESSO_NEGADO'::text;
    return;
  end if;

  if not exists (select 1 from bolao.cdb_confirmation_allowance a where a.entry_id = v_entry_id) then
    return query select false, 'SEM_PERMISSAO'::text;
    return;
  end if;

  -- O destinatario e derivado da ENTRADA, nunca recebido do cliente. Guardado como hash: esta
  -- tabela existe para proteger participante, e guardar identificador em claro criaria a
  -- exposicao que o resto da plataforma passou o dia fechando.
  v_hash := encode(sha256(convert_to('entry:' || v_entry_id, 'utf8')), 'hex');

  insert into bolao.notification_deliveries (app, business_key, recipient_hash, generation)
  values ('cdb2026', 'cdb2026:entry-saved-confirmation:v1', v_hash, 1)
  on conflict (app, business_key, recipient_hash, generation) do nothing
  returning bolao.notification_deliveries.delivery_id into v_id;

  if v_id is null then
    return query select false, 'JA_ENVIADO'::text;
    return;
  end if;

  return query select true, null::text;
end;
$$;

-- O navegador do participante precisa chamar isto -- e so isto. Ele nao alcanca
-- `reserve_delivery` nem a tabela de permissao.
revoke all on function public.cdb_reserve_entry_saved_email(text) from public;
grant execute on function public.cdb_reserve_entry_saved_email(text) to anon, authenticated, service_role;

select 'permissao de comprovante criada (vazia: nega tudo ate alguem ser liberado)' as resultado;
