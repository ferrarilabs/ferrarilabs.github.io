-- 019_backfill_powerball_0808_partial.sql — reconstrucao do 08/08 a partir de evidencia real.
--
-- O Eduardo verificou no Gmail SENT: 14 mensagens com o assunto do resultado de 08/08, enviadas
-- em 2026-08-09 ~08:21 ET. NAO ha mensagem para Rodrigo Hajj. E o incidente historico de 14/15.
--
-- O ledger nao existia quando aquele e-mail saiu, entao o estado e reconstruido dos fatos:
--   15 esperados | 14 ACCEPTED (provenance HISTORICAL_GMAIL_SENT_EVIDENCE) | 1 PENDING
--
-- O job NAO fica 'sent': um destinatario pretendido nunca recebeu. Fica em failed_retryable,
-- que e o estado parcial deste schema -- e o unico alvo elegivel de catch-up e o pendente.
--
-- providerMessageId e null DE PROPOSITO. Nao se inventa identificador de provedor para
-- entrega historica; a proveniencia diz de onde veio a certeza.
--
-- LIMITACAO REGISTRADA: o Powerball nao tem id opaco de participante -- o sistema inteiro
-- referencia por nome, e esses nomes ja estao no data.js publico. Nao ha exposicao NOVA aqui,
-- mas tambem nao ha id estavel: renomear um participante quebra a referencia.
--
-- CONTENT HASH: gravado junto, senao o portao de imutabilidade recusa o catch-up legitimo com
-- CONTENT_CONFLICT -- comportamento correto (falha fechada quando nao sabe), mas que travaria o
-- unico envio que ainda falta. Descoberto rodando o ciclo real.
--
-- ROLLBACK: update ... set status='sent', payload_snapshot=... (ver git deste arquivo).

update bolao_notif_jobs set status='failed_retryable'::bolao_notif_status, sent_at=null, last_error='PARTIAL_HISTORICO: 14 de 15 entregues; 1 pendente', payload_snapshot='{"drawId": "2026-08-08", "recipients": [{"entryRef": "Eduardo Ferrari", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Samuel Huller", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Jorge Augusto Junqueira Ferreira", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Camila Ribeiro", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Simone Hirle da Costa", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Gustavo Bossle", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Marcelo Moreira", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Amanda Quaresma", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "REDACTED_PARTICIPANT", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Ewerton Gruba Silva", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Marcus Steffenon", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Leandro Augustineli", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Marcelo Minghetti Pereira", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Alan Rech", "state": "ACCEPTED", "providerMessageId": null, "provenance": "HISTORICAL_GMAIL_SENT_EVIDENCE"}, {"entryRef": "Rodrigo Hajj", "state": "PENDING", "providerMessageId": null, "provenance": "AWAITING_CATCHUP"}], "expectedRecipientCount": 15, "knownAccepted": 14, "pending": 1, "deliverySemantics": "AT_MOST_ONCE_UNTIL_ACCEPT/UNCERTAIN_AFTER_PROVIDER_ACCEPT", "backfillNote": "Reconstruido de evidencia do Gmail SENT (2026-08-09 ~08:21 ET, assunto ''Bolao do Ferrari - Resultado Powerball - 08.08.2026 22:59 ET'', 14 mensagens). providerMessageId e null de proposito: nao se inventa identificador de provedor. Os 14 ACCEPTED NUNCA podem ser reenviados."}'::jsonb where idempotency_key='powerball:draw-result:2026-08-08:v1';
select payload_snapshot->>'knownAccepted' as aceitos, payload_snapshot->>'pending' as pendentes, status::text from bolao_notif_jobs where idempotency_key='powerball:draw-result:2026-08-08:v1';
