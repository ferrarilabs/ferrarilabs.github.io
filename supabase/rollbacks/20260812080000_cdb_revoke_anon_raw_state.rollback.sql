--
-- PLANO DE ROLLBACK de 20260812080000_cdb_revoke_anon_raw_state.sql
--
-- Este arquivo NAO e uma migracao. O sufixo `.rollback.sql` esta em NON_MIGRATION_SUFFIXES
-- (scripts/db/migration_harness.mjs) e por isso ele nunca entra no conjunto de migracoes nem no
-- ledger. Ele existe porque o harness exige que toda migracao classificada como DESTRUCTIVE_DDL
-- carregue o seu plano de rollback ao lado. O plano, aqui, e uma RECUSA — e a recusa e o conteudo.
--
-- ═══ POR QUE A MIGRACAO FOI CLASSIFICADA COMO DESTRUTIVA ═════════════════════════════════════
--
-- O classificador marca `DROP POLICY`. A migracao usa o idioma idempotente
-- `drop policy if exists ... ; create policy ...` para as tres policies de anon
-- (`allow anon read`, `allow anon insert`, `allow anon update`), recriando cada uma no mesmo
-- arquivo com escopo ESTREITADO de "qualquer id" para `id in ('main','br2026')`.
--
-- Ou seja: nenhuma policy foi permanentemente removida por esta migracao. A classificacao
-- DESTRUCTIVE_DDL e conservadora e esta correta como politica — um `DROP POLICY` merece sempre
-- um plano escrito. Este e o plano.
--
-- ═══ POR QUE O ROLLBACK E PROIBIDO ═══════════════════════════════════════════════════════════
--
-- A migracao fechou uma exposicao MEDIDA em producao com a chave publicavel (a que e servida ao
-- navegador em todo config.js):
--
--   GET   /rest/v1/bolao_state?id=eq.cdb2026&select=state  -> 200, devolvendo participantEmail,
--                                                             payerName e paymentMethod dos 12
--                                                             participantes do CDB2026
--   PATCH /rest/v1/bolao_state?id=eq.<qualquer>            -> 204, UPDATE anonimo permitido
--
-- Reverter esta migracao significa recriar as policies na forma ANTERIOR (sem o recorte de `id`),
-- o que reabre exatamente essa leitura de PII e essa escrita anonima. Isso e a regressao de Q38.
--
-- Estado atual de producao (verificado em transacao READ ONLY, 2026-08-12):
--
--   pg_policies WHERE tablename='bolao_state'                       -> 0 policies
--   has_table_privilege('anon','public.bolao_state', SELECT/INSERT/UPDATE/DELETE) -> false x4
--
-- O corte final foi portanto ALEM desta migracao: hoje anon nao alcanca `public.bolao_state` de
-- forma alguma, e a leitura publica passa pela superficie sanitizada (`v_state_document`) e pelas
-- RPCs confiaveis. Recriar qualquer policy de anon nesta tabela contradiz o estado alcancado.
--
-- ═══ O QUE FAZER SE FOR PRECISO RECUAR ═══════════════════════════════════════════════════════
--
-- Nao reverta esta migracao. Se o objetivo for restaurar acesso de leitura a um produto:
--
--   1. use a superficie sanitizada (`public.v_state_document`), que nao expoe email, pagador nem
--      metodo de pagamento;
--   2. se um leitor privado precisar do documento completo, use service_role / runtime confiavel
--      (o padrao dos 6 leitores privados ja existentes);
--   3. se ainda assim for necessario mexer em policy de anon, isso e uma DECISAO DE RISCO do
--      operador e precisa de registro proprio — nao de um rollback silencioso.
--
-- A recuperacao de dados, se algum dia for necessaria, vem dos backups intactos em
-- ferrarilabs-work/backups/production-pre-migration-20260811-151516 — nunca de reabrir anon.
--
-- ═══ GUARDA EXECUTAVEL ═══════════════════════════════════════════════════════════════════════
--
-- Se alguem executar este arquivo por engano, ele falha antes de tocar em qualquer objeto.

do $$
begin
  raise exception
    'ROLLBACK RECUSADO: reverter 20260812080000_cdb_revoke_anon_raw_state reabre a exposicao de PII '
    'do CDB2026 a chave anonima e regride Q38. Leia o cabecalho deste arquivo. Nenhum objeto foi alterado.';
end
$$;
