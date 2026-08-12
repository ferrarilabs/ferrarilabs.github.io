--
-- PLANO DE ROLLBACK de 20260812230000_participants_email_is_not_identity.sql
--
-- Nao e uma migracao. O sufixo `.rollback.sql` esta em NON_MIGRATION_SUFFIXES
-- (scripts/db/migration_harness.mjs), entao este arquivo nunca entra no conjunto de migracoes nem
-- no ledger. Ele existe porque o harness exige plano de rollback ao lado de toda migracao
-- classificada DESTRUCTIVE_DDL — e a migracao original faz `drop index`.
--
-- ═══ O ROLLBACK E POSSIVEL, MAS SO ATE UM PONTO ════════════════════════════════════════════════
--
-- A migracao trocou `participants_email_uidx` (UNIQUE) por `participants_email_idx` (nao-unico).
-- Reverter significa recriar o UNIQUE. Isso FUNCIONA enquanto nenhum e-mail estiver em duas linhas
-- vivas de `bolao.participants`, e FALHA com unique_violation depois disso.
--
-- E a falha e o ponto. Q33-A1 estabeleceu que dois pares pai/filho compartilham uma caixa de
-- correio:
--
--     Fabrizio Marodin  /  Enrico Marodin
--     Samuel Huller     /  Arthur Lopes Huller
--
-- Assim que essas quatro pessoas existirem como participantes distintos, o indice UNIQUE e
-- incompativel com os DADOS REAIS. Recria-lo exigiria apagar ou fundir uma pessoa de cada par —
-- que e precisamente a fusao de identidades que o RED Q33-A1 existia para impedir, e que o
-- operador rejeitou por escrito.
--
-- Portanto: se este rollback falhar, NAO "resolva" o conflito mexendo nos participantes.
-- A restricao e que esta errada, nao os dados.
--
-- ═══ VERIFICACAO ANTES DE TENTAR ═══════════════════════════════════════════════════════════════
--
--   select email, count(*) from bolao.participants
--    where email is not null and redacted_at is null
--    group by email having count(*) > 1;
--
-- Se voltar qualquer linha, o rollback NAO e aplicavel. Pare.
--
-- ═══ ROLLBACK, COM GUARDA ══════════════════════════════════════════════════════════════════════

do $$
declare
  compartilhados int;
begin
  select count(*) into compartilhados from (
    select 1 from bolao.participants
     where email is not null and redacted_at is null
     group by email having count(*) > 1
  ) t;

  if compartilhados > 0 then
    raise exception
      'ROLLBACK RECUSADO: % e-mail(s) pertencem a mais de um participante vivo. Recriar '
      'participants_email_uidx exigiria fundir ou apagar uma pessoa real de um par pai/filho — a '
      'decisao Q33-A1 do operador proibe isso explicitamente. Nenhum objeto foi alterado.',
      compartilhados;
  end if;

  drop index if exists bolao.participants_email_idx;

  create unique index participants_email_uidx
    on bolao.participants (email)
    where email is not null and redacted_at is null;

  raise notice 'participants_email_uidx recriado; nenhum e-mail estava compartilhado.';
end
$$;
