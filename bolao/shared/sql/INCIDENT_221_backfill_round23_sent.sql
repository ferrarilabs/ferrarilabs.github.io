-- INCIDENT_221_backfill_round23_sent.sql
-- NAO E UMA MIGRACAO NUMERADA. Nao roda em nenhum pipeline automatico. Aplicar manualmente,
-- UMA VEZ, DEPOIS de 030_br_round_notification_durability.sql, e SO apos revisao humana.
--
-- ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────────────────────────
--
-- A rodada 23 do BR2026 ja foi enviada -- 4 vezes, na verdade -- para os 11 participantes reais,
-- antes da causa raiz do Issue #221 ser corrigida. A tabela nova (`bolao_round_notif_jobs`) nasce
-- vazia: sem este backfill, a PRIMEIRA execucao depois do deploy veria a rodada 23 como nao
-- reivindicada e enviaria uma QUINTA vez.
--
-- Este script marca a rodada 23 como SENT com os 11 destinatarios ACCEPTED, para que o
-- reconciliador a trate como ja concluida -- exatamente a mesma disposicao que a rodada teria se
-- o ledger duravel tivesse funcionado desde o inicio.
--
-- ─── PROVENIENCIA DA EVIDENCIA (secao 17 do protocolo de incidente: "no inferred deliveries") ──
--
-- Os 11 entryRefs e os hashes abaixo vieram do LOG da execucao real do GitHub Actions
-- run 32101043496 (2026-08-18T04:57:55Z, a ultima das 4 execucoes reais), evento
-- `round_send_completed` com accepted=11, failed=0, uncertain=0 -- e do evento
-- `recipient_accepted` individual de cada um dos 11 entryRefs, na MESMA execucao. Os logs do
-- GitHub Actions sao imutaveis e publicamente auditaveis em
-- https://github.com/ferrarilabs/ferrarilabs.github.io/actions/runs/32101043496 -- nao e uma
-- inferencia, e a leitura direta do que o provedor de e-mail realmente aceitou.
--
-- As outras 3 execucoes (32092990719, 32095864162, 32098846982) mostram o MESMO
-- recipientSetHash (e5f48fd6d95ed67e) e os MESMOS 11 entryRefs aceitos -- a duplicacao foi do
-- ENVIO, nao do CONJUNTO de destinatarios, que permaneceu identico e completo nas 4 execucoes.
--
-- providerMessageId NAO foi extraido do log (o evento operacional `recipient_accepted` nao
-- imprime esse campo, so o estado -- por design, para nao vazar detalhe de transporte em log
-- publico). Preenchido aqui com uma referencia ao run do GitHub Actions, nao com um valor
-- inventado.
--
-- Nenhum endereco de e-mail, nome ou dado de pagamento aparece neste arquivo -- so ids opacos
-- de entrada, que e exatamente o que `round_notification_ledger.py` já exige.
--
-- ─── O QUE ISTO NAO FAZ ──────────────────────────────────────────────────────────────────────────
--
-- Nao envia e-mail. Nao apaga evidencia. Nao reescreve pontuacao, classificacao ou picks. Nao
-- toca em nenhuma outra rodada. E reversivel: apagar a linha (ver rodape) devolve a rodada 23 ao
-- estado "nunca vista pelo ledger duravel" -- o que so deve ser feito se este backfill se provar
-- errado, nunca para "tentar de novo".

insert into bolao_round_notif_jobs (
  idempotency_key, pool_id, round_number, state,
  content_hash, recipient_set_hash, fixture_set_hash,
  expected_recipient_count, resolved_recipient_count, recipients,
  attempt_count, claimed_by, lease_until, sent_at
) values (
  'br2026:round-results:23:v1', 'br2026', 23, 'SENT',
  'f50d0c6f969b0d4d', 'e5f48fd6d95ed67e', '306ad038036c3a9a',
  11, 11,
  jsonb_build_array(
    jsonb_build_object('entryRef', '8eaea962-a54e-499c-9d5e-e2c83bf88ff9', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', '667814fd-17b4-4663-9cc4-ee97cac0f5ca', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', '4ba26572-82ef-4f98-975f-74cfbaac2426', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', '416f4c04-75fe-45d6-b5b4-7506a2efc75d', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', 'a2d98c5a-a016-4507-82ec-543980806f63', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', 'a2bb9a90-4b62-4154-a235-35c05db83215', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', 'bebac118-d942-4b10-ac3f-63fbee03d140', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', 'f9b44d3f-bf64-491a-8dfd-a35a8a9fbff8', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', 'cafb8261-4e8f-4afb-9323-893814d4c761', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', 'd333b5c7-9fc3-461f-b172-14db1e2fb5c5', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null),
    jsonb_build_object('entryRef', '79f3aec6-5d46-4db8-b33e-9685a91218b7', 'state', 'ACCEPTED', 'providerMessageId', 'gh-actions-run-32101043496', 'lastError', null)
  ),
  1, null, null, now()
)
on conflict (idempotency_key) do nothing;
-- `do nothing`, nao `do update`: se a linha ja existir (por exemplo, este script rodado por
-- engano uma segunda vez, ou a rodada ja tiver sido reconciliada por outro caminho), a intencao
-- e preservar o que ja esta la, nunca sobrescrever com este backfill.

-- Verificacao pos-aplicacao (rodar manualmente, nao faz parte do INSERT):
--   select round_number, state, expected_recipient_count, resolved_recipient_count,
--          jsonb_array_length(recipients) as n_recipients,
--          (select count(*) from jsonb_array_elements(recipients) r where r->>'state' = 'ACCEPTED') as n_accepted
--     from bolao_round_notif_jobs where idempotency_key = 'br2026:round-results:23:v1';
--   -- esperado: state=SENT, expected_recipient_count=11, resolved_recipient_count=11,
--   --           n_recipients=11, n_accepted=11

-- ROLLBACK (so se este backfill se provar errado -- nunca para "tentar de novo"):
-- delete from bolao_round_notif_jobs where idempotency_key = 'br2026:round-results:23:v1';
